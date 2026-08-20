const PRIORITY_STYLES = {
  low: 'bg-gray-200 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-red-100 text-red-700'
};

let filter = 'all';
let search = '';
let searchTimer;

function query() {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('done', filter);
  if (search) params.set('q', search);
  return params.toString() ? `?${params}` : '';
}

function badge(task) {
  const span = document.createElement('span');
  span.className = `px-2 py-1 rounded-full text-xs ${PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium}`;
  span.textContent = task.priority || 'medium';
  return span;
}

function dueCell(task) {
  const cell = document.createElement('td');
  if (!task.dueDate) {
    cell.className = 'p-3 text-gray-400';
    cell.textContent = '—';
    return cell;
  }
  const due = new Date(task.dueDate);
  const overdue = !task.done && due < new Date();
  cell.className = overdue ? 'p-3 text-red-600 font-medium' : 'p-3';
  cell.textContent = due.toLocaleDateString();
  return cell;
}

async function fetchTasks() {
  try {
    const response = await fetch(`/api/tasks${query()}`);
    const tasks = await response.json();
    const taskList = document.getElementById('taskList');
    taskList.innerHTML = '';
    tasks.forEach(task => {
      const row = document.createElement('tr');

      const doneCell = document.createElement('td');
      doneCell.className = 'p-3';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'h-4 w-4';
      checkbox.checked = Boolean(task.done);
      checkbox.onchange = () => toggleTask(task._id, checkbox.checked);
      doneCell.appendChild(checkbox);
      row.appendChild(doneCell);

      const cells = [task.title, task.description || ''];
      for (const value of cells) {
        const cell = document.createElement('td');
        cell.className = task.done ? 'p-3 line-through text-gray-400' : 'p-3';
        cell.textContent = value;
        row.appendChild(cell);
      }

      const priorityCell = document.createElement('td');
      priorityCell.className = 'p-3';
      priorityCell.appendChild(badge(task));
      row.appendChild(priorityCell);

      row.appendChild(dueCell(task));

      const created = document.createElement('td');
      created.className = task.done ? 'p-3 line-through text-gray-400' : 'p-3';
      created.textContent = new Date(task.createdAt).toLocaleString();
      row.appendChild(created);

      const actions = document.createElement('td');
      actions.className = 'p-3';
      const button = document.createElement('button');
      button.className = 'bg-red-500 text-white px-3 py-1 rounded-md hover:bg-red-600';
      button.textContent = 'Delete';
      button.onclick = () => deleteTask(task._id);
      actions.appendChild(button);
      row.appendChild(actions);
      taskList.appendChild(row);
    });

    const pending = tasks.filter(task => !task.done).length;
    document.getElementById('taskCount').textContent = `(${tasks.length} shown, ${pending} pending)`;
  } catch (err) {
    console.error('Error fetching tasks:', err);
  }
}

async function addTask() {
  const title = document.getElementById('title').value;
  const description = document.getElementById('description').value;
  const priority = document.getElementById('priority').value;
  const dueDate = document.getElementById('dueDate').value;

  if (!title) {
    alert('Title is required');
    return;
  }

  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, priority, dueDate })
    });
    if (response.ok) {
      document.getElementById('title').value = '';
      document.getElementById('description').value = '';
      document.getElementById('dueDate').value = '';
      fetchTasks(); // Refresh task list
    } else {
      alert('Error adding task');
    }
  } catch (err) {
    console.error('Error adding task:', err);
    alert('Error adding task');
  }
}

async function toggleTask(id, done) {
  try {
    const response = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done })
    });
    if (!response.ok) {
      alert('Error updating task');
    }
    fetchTasks();
  } catch (err) {
    console.error('Error updating task:', err);
    alert('Error updating task');
    fetchTasks();
  }
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;

  try {
    const response = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (response.ok) {
      fetchTasks();
    } else {
      alert('Error deleting task');
    }
  } catch (err) {
    console.error('Error deleting task:', err);
    alert('Error deleting task');
  }
}

async function clearCompleted() {
  if (!confirm('Delete every completed task?')) return;

  try {
    const response = await fetch('/api/tasks/completed', { method: 'DELETE' });
    if (!response.ok) {
      alert('Error clearing tasks');
    }
    fetchTasks();
  } catch (err) {
    console.error('Error clearing tasks:', err);
    alert('Error clearing tasks');
  }
}

function setFilter(button) {
  filter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach(other => {
    const active = other === button;
    other.className = `filter px-3 py-2 ${active ? 'bg-blue-500 text-white' : 'bg-white hover:bg-gray-100'}`;
  });
  fetchTasks();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.filter').forEach(button => {
    button.onclick = () => setFilter(button);
  });
  document.getElementById('search').addEventListener('input', event => {
    search = event.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(fetchTasks, 250);
  });
  fetchTasks();
});
