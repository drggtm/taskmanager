async function fetchTasks() {
    try {
      const response = await fetch('/api/tasks');
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

        const cells = [task.title, task.description || '', new Date(task.createdAt).toLocaleString()];
        for (const value of cells) {
          const cell = document.createElement('td');
          cell.className = task.done ? 'p-3 line-through text-gray-400' : 'p-3';
          cell.textContent = value;
          row.appendChild(cell);
        }
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
    } catch (err) {
      console.error('Error fetching tasks:', err);
    }
  }
  
  async function addTask() {
    const title = document.getElementById('title').value;
    const description = document.getElementById('description').value;
  
    if (!title) {
      alert('Title is required');
      return;
    }
  
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description })
      });
      if (response.ok) {
        document.getElementById('title').value = '';
        document.getElementById('description').value = '';
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

  // Load tasks on page load
  document.addEventListener('DOMContentLoaded', fetchTasks);