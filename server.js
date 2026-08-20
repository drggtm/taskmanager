const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const Task = require('./models/Task');

dotenv.config();

const app = express();
app.use(express.json());

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  next(err);
});

// Counters behind /metrics. Keyed by method|route|status, so cardinality is
// bounded by the route table rather than by whatever paths clients request.
const requests = new Map();

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const key = `${req.method}|${req.route ? req.route.path : 'other'}|${res.statusCode}`;
    const entry = requests.get(key) || { count: 0, seconds: 0 };
    entry.count += 1;
    entry.seconds += Number(process.hrtime.bigint() - start) / 1e9;
    requests.set(key, entry);
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public'))); // Serve static files

mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const PRIORITIES = ['low', 'medium', 'high'];

// Each parser returns the value to store, or undefined when the input is invalid.
const FIELDS = {
  title: v => (typeof v === 'string' && v.trim() ? v.trim() : undefined),
  description: v => (typeof v === 'string' ? v.trim() : undefined),
  done: v => (typeof v === 'boolean' ? v : undefined),
  priority: v => (PRIORITIES.includes(v) ? v : undefined),
  dueDate: v => (v === null || v === '' ? null : Number.isNaN(Date.parse(v)) ? undefined : new Date(v))
};

function parseFields(body) {
  const fields = {};
  for (const [name, parse] of Object.entries(FIELDS)) {
    if (body[name] === undefined) continue;
    const value = parse(body[name]);
    if (value === undefined) return { error: `Invalid value for "${name}"` };
    fields[name] = value;
  }
  return { fields };
}

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

app.get('/readyz', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ status: connected ? 'ready' : 'not ready' });
});

app.get('/metrics', async (req, res) => {
  const lines = [
    '# HELP http_requests_total Total HTTP requests handled.',
    '# TYPE http_requests_total counter'
  ];
  const durations = ['# HELP http_request_duration_seconds Request latency.', '# TYPE http_request_duration_seconds summary'];
  for (const [key, entry] of requests) {
    const [method, route, status] = key.split('|');
    const labels = `{method="${method}",route="${route}",status="${status}"}`;
    lines.push(`http_requests_total${labels} ${entry.count}`);
    durations.push(`http_request_duration_seconds_sum${labels} ${entry.seconds.toFixed(6)}`);
    durations.push(`http_request_duration_seconds_count${labels} ${entry.count}`);
  }
  lines.push(...durations);
  lines.push('# HELP process_uptime_seconds Seconds since the process started.');
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${process.uptime().toFixed(3)}`);
  lines.push('# HELP mongodb_up Whether the mongoose connection is usable.');
  lines.push('# TYPE mongodb_up gauge');
  lines.push(`mongodb_up ${mongoose.connection.readyState === 1 ? 1 : 0}`);

  // Only query when the connection is up: a scrape must not block on a dead database.
  if (mongoose.connection.readyState === 1) {
    try {
      const [total, done] = await Promise.all([Task.countDocuments(), Task.countDocuments({ done: true })]);
      lines.push('# HELP tasks_total Tasks stored, by state.');
      lines.push('# TYPE tasks_total gauge');
      lines.push(`tasks_total{state="done"} ${done}`);
      lines.push(`tasks_total{state="pending"} ${total - done}`);
    } catch (err) {
      console.error('Metrics task count failed:', err.message);
    }
  }

  res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
});

app.post('/api/tasks', async (req, res) => {
  const { fields, error } = parseFields(req.body);
  if (error) {
    return res.status(400).json({ error });
  }
  try {
    const task = await new Task(fields).save();
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/tasks', async (req, res) => {
  const filter = {};
  if (req.query.done === 'true' || req.query.done === 'false') {
    filter.done = req.query.done === 'true';
  }
  if (req.query.q) {
    filter.title = { $regex: escapeRegex(String(req.query.q)), $options: 'i' };
  }
  try {
    const tasks = await Task.find(filter).sort({ done: 1, createdAt: -1 });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Declared before /api/tasks/:id so "completed" is not read as an id.
app.delete('/api/tasks/completed', async (req, res) => {
  try {
    const { deletedCount } = await Task.deleteMany({ done: true });
    res.json({ deleted: deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/tasks/:id', async (req, res) => {
  const { fields, error } = parseFields(req.body);
  if (error) {
    return res.status(400).json({ error });
  }
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, fields, { new: true, runValidators: true });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid task id' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(204).send();
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid task id' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await mongoose.connection.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
