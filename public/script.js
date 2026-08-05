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
  
  // Load tasks on page load
  document.addEventListener('DOMContentLoaded', fetchTasks);