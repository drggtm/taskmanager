async function fetchTasks() {
    try {
      const response = await fetch('/api/tasks');
      const tasks = await response.json();
      const taskList = document.getElementById('taskList');
      taskList.innerHTML = '';
      tasks.forEach(task => {
        const row = document.createElement('tr');
        const cells = [task.title, task.description || '', new Date(task.createdAt).toLocaleString()];
        for (const value of cells) {
          const cell = document.createElement('td');
          cell.className = 'p-3';
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