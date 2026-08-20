# Task Manager

A small Node.js/Express + MongoDB task API with a static frontend, packaged for
Kubernetes with Helm and built into a container image by GitHub Actions.

The app itself is deliberately simple — the substance of this project is the
delivery path: a hardened image, a parameterized Helm chart, and probes that
behave correctly when the database goes away.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 18 (alpine), Express 5 |
| Data | MongoDB via Mongoose 8 |
| Frontend | Static HTML + vanilla JS, Tailwind via CDN — list, add, complete, filter, delete |
| Image | Multi-stage Docker build, runs as non-root `nodeuser` |
| Packaging | Helm chart (`helm/task-manager`) |
| CI | GitHub Actions → GitHub Container Registry |
| Metrics | `/metrics` in Prometheus text format, no extra dependency |

## API

| Method | Endpoint | Description | Success | Errors |
|---|---|---|---|---|
| GET | `/api/tasks` | List tasks; `?done=true\|false` and `?q=` filter | 200 | 500 |
| POST | `/api/tasks` | Create a task | 201 | 400 (missing title / bad field / malformed JSON) |
| PATCH | `/api/tasks/:id` | Update any subset of the mutable fields | 200 | 404 (not found), 400 (invalid id, bad field, empty body) |
| DELETE | `/api/tasks/completed` | Delete every done task, returns `{ "deleted": n }` | 200 | 500 |
| DELETE | `/api/tasks/:id` | Delete a task | 204 | 404 (not found), 400 (invalid id) |
| GET | `/healthz` | Liveness — process is up | 200 | — |
| GET | `/readyz` | Readiness — MongoDB reachable | 200 | 503 |
| GET | `/metrics` | Prometheus exposition | 200 | — |
| GET | `/` | Static frontend | 200 | — |

Mutable fields, shared by `POST` and `PATCH`: `title` (non-empty string),
`description` (string), `done` (boolean), `priority` (`low\|medium\|high`,
default `medium`), `dueDate` (parseable date, or `null`/`""` to clear). Only
`title` is required, and only on create. Anything else in the body is ignored;
a field that is present but invalid is a 400 naming that field.

Lists come back with pending tasks first, newest first within each group. `q`
matches titles case-insensitively and is regex-escaped, so a search for `(*`
returns nothing rather than erroring.

The page at `/` drives all of it: a form to add a task with priority and due
date, filter buttons that hit `?done=`, a debounced search box that hits `?q=`,
a Done checkbox per row, a Delete button per row, and Clear done for the bulk
delete. Overdue tasks show their date in red. Rows are built with `textContent`,
not `innerHTML`, so a task title containing markup is rendered as text rather
than executed.

Tasks created before `done`, `priority`, or `dueDate` existed have no such key in
MongoDB. Mongoose reads a missing key as the schema default, so old documents
render as not-done, medium priority, no due date, without a migration.

### Metrics

`/metrics` is written by hand rather than pulled from `prom-client`, so the image
gains no dependency:

| Metric | Type | Labels |
|---|---|---|
| `http_requests_total` | counter | `method`, `route`, `status` |
| `http_request_duration_seconds_{sum,count}` | summary | `method`, `route`, `status` |
| `process_uptime_seconds` | gauge | — |
| `mongodb_up` | gauge | — |
| `tasks_total` | gauge | `state` (`done`, `pending`) |

`route` is the Express route pattern (`/api/tasks/:id`), never the raw path, so
label cardinality is bounded by the route table instead of growing with every id
a client asks for. Requests that match no route are counted as `other`.

Counters live in process memory, so each replica reports its own — scrape them
all and sum. `tasks_total` queries MongoDB only when the connection is ready: a
scrape must never block behind a dead database, which is the same reason
`/healthz` ignores MongoDB.

Both the chart and the raw manifests annotate the pods for an annotation-based
Prometheus (`prometheus.io/scrape`, `/path`, `/port`); set `metrics.enabled=false`
to drop them.

### Why two health endpoints

`/healthz` deliberately does **not** check MongoDB. Restarting a pod cannot fix a
database outage, so tying liveness to the database would crash-loop every replica
during one. `/readyz` does check it, which removes the pod from the Service
endpoints until the database returns — traffic stops, the pod survives.

## Local development

```bash
npm install
cp .env.example .env      # then set MONGO_URI
npm start                 # http://localhost:3000
```

`.env`:

```
MONGO_URI=mongodb://localhost:27017/taskmanager
PORT=3000
```

## Docker

```bash
docker build -t task-manager:local .
docker network create tm-net
docker run -d --name tm-mongo --network tm-net mongo:7
docker run -d --name tm-app --network tm-net -p 3000:3000 \
  -e MONGO_URI="mongodb://tm-mongo:27017/taskmanager" task-manager:local
```

## Kubernetes (Helm)

The chart does **not** bundle MongoDB — point it at one you already run. The
default `mongodb.uri` assumes a Service named `mongodb` in the same namespace.

```bash
helm lint helm/task-manager
helm template task-manager helm/task-manager        # inspect before applying

helm install task-manager helm/task-manager \
  --set image.repository=ghcr.io/drggtm/taskmanager \
  --set image.tag=latest \
  --set mongodb.uri='mongodb://mongodb:27017/taskmanager'
```

For a real cluster, create the Secret outside the chart and reference it —
values passed with `--set` are stored in the release history:

```bash
kubectl create secret generic mongo-creds --from-literal=mongo-uri='mongodb+srv://...'
helm install task-manager helm/task-manager --set mongodb.existingSecret=mongo-creds
```

### Configuration

| Value | Default | Description |
|---|---|---|
| `replicaCount` | `2` | Pod count; ignored when autoscaling is enabled |
| `image.repository` / `image.tag` | `ghcr.io/placeholder/task-manager` / `latest` | Image to run |
| `image.pullPolicy` | `IfNotPresent` | |
| `service.type` / `service.port` | `ClusterIP` / `80` | |
| `service.targetPort` | `3000` | Container port, also passed as `PORT` |
| `mongodb.uri` | `mongodb://mongodb:27017/taskmanager` | Used only when `existingSecret` is empty |
| `mongodb.existingSecret` | `""` | Reference a Secret managed outside the chart |
| `mongodb.existingSecretKey` | `mongo-uri` | Key within that Secret |
| `metrics.enabled` | `true` | Adds `prometheus.io/*` pod annotations |
| `metrics.path` | `/metrics` | Scrape path in those annotations |
| `probes.livenessPath` | `/healthz` | |
| `probes.readinessPath` | `/readyz` | |
| `resources` | 200m/256Mi → 500m/512Mi | Requests and limits |
| `autoscaling.enabled` | `false` | Creates an HPA on CPU when true |
| `ingress.enabled` | `true` | |
| `ingress.className` | `nginx` | See note below |
| `ingress.annotations` | `nginx.ingress.kubernetes.io/rewrite-target: /` | Replace when switching ingress controller |
| `ingress.hosts` | `task-manager.local` | |
| `nameOverride` / `fullnameOverride` | unset | Override the generated resource names |

**Ingress class matters.** The default `nginx` suits minikube (`minikube addons
enable ingress`). On k3s, which ships Traefik, use `--set
ingress.className=traefik`. A mismatched class fails *silently* — the Ingress is
created but never gets an ADDRESS and no error is reported.

If `mongodb.uri` is empty and no `existingSecret` is set, the chart fails at
render time rather than installing a broken release.

## Kubernetes (raw manifests)

`k8s/` is a self-contained alternative to the chart, aimed at local minikube
work. Unlike the chart it also runs MongoDB in-cluster, so there is no external
database to point at:

```sh
eval $(minikube docker-env)
docker build -t task-manager:v1 .
kubectl apply -f k8s/
kubectl port-forward svc/task-manager 3000:3000
```

The build must run inside `minikube docker-env` (or the image loaded with
`minikube image load`), because `imagePullPolicy: IfNotPresent` with the local
tag `task-manager:v1` never reaches a registry.

Differences from the chart, deliberate for a local cluster: `MONGO_URI` is a
plain env var rather than a Secret (the in-cluster URI carries no credentials),
the Service is ClusterIP with no Ingress, and MongoDB is backed by a 1Gi PVC
with `strategy: Recreate`.

Both Deployments set requests and limits. `task-manager` points **liveness** at
`/readyz`, not `/healthz` — the app does not retry a failed initial mongoose
connection, so a pod that loses the startup race has to be restarted to recover.
`failureThreshold: 6` with a 20s period gives MongoDB about two minutes to come
back before a restart is triggered.

## Verified deployment

Installed and exercised on a single-node k3s cluster (v1.36.2):

- `helm install --wait` → 2/2 pods Ready, Secret generated, app connected to MongoDB
- Full CRUD through the ClusterIP and through the Ingress
- `helm upgrade --reuse-values` → revision 2, no downtime
- **MongoDB scaled to zero:** pods went `READY 0/1` with `RESTARTS=0` and were
  removed from the Service endpoints; scaling MongoDB back restored both
  automatically. Liveness correctly ignored the outage.
- **Rolling update:** completed in 25s for 2 replicas, with SIGTERM handled and
  the mongoose connection closed cleanly.

## CI/CD

`.github/workflows/build.yml` builds the image and pushes it to
`ghcr.io/<owner>/<repo>` on pushes to the `frontend` branch, tagging by branch,
PR, semver, and short SHA, with GitHub Actions layer caching.

`.github/workflows/claude.yml` runs an automated review when the repository owner
opens a pull request, or comments `@claude` on one. Both paths are gated on
`author_association == 'OWNER'`, so forks cannot trigger it.

## Project structure

```
.
├── .github/workflows/
│   ├── build.yml            # image build + GHCR push
│   └── claude.yml           # automated PR review
├── helm/task-manager/
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
│       ├── _helpers.tpl
│       ├── deployment.yaml  # probes, secret checksum, HPA-aware replicas
│       ├── service.yaml
│       ├── ingress.yaml
│       ├── secret.yaml
│       └── hpa.yaml
├── k8s/                      # raw manifests: app + in-cluster MongoDB
│   ├── mongo-deployment.yaml
│   ├── mongo-pvc.yaml
│   ├── mongo-service.yaml
│   ├── task-manager-deployment.yaml
│   └── task-manager-service.yaml
├── models/Task.js
├── public/                  # static frontend (index.html + script.js)
├── Dockerfile               # multi-stage, non-root
├── .dockerignore            # keeps .env, .git, helm out of the image
├── .env.example
├── server.js
└── package.json
```

## Known gaps

- No automated tests.
- MongoDB is expected to exist already; the chart has no dependency on it.
- No TLS on the Ingress.
