import { supabase } from '../lib/supabaseClient';

const devLog = (...args) => {
  if (process.env.NODE_ENV === 'development') console.log(...args);
};

const TASK_SELECT = `
  id,
  title,
  description,
  assigned_to,
  assigned_email,
  assigned_name,
  assigned_by,
  priority,
  due_date,
  task_status,
  department,
  created_at,
  updated_at,
  assignee:assigned_to (
    id,
    email,
    full_name,
    department
  ),
  assigner:assigned_by (
    id,
    email,
    full_name
  )
`;

const TASK_BASE_SELECT = `
  id,
  title,
  description,
  assigned_to,
  assigned_email,
  assigned_name,
  assigned_by,
  priority,
  due_date,
  task_status,
  department,
  created_at,
  updated_at
`;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function hydrateTaskEmployees(tasks) {
  const employeeIds = Array.from(
    new Set(
      (tasks || [])
        .flatMap((task) => [task.assigned_to, task.assigned_by])
        .filter(Boolean)
    )
  );

  if (!employeeIds.length) return tasks || [];

  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, email, full_name, department')
    .in('id', employeeIds);

  devLog('Fetch response:', { source: 'task employees', data: employees, error });
  if (error) {
    console.error('CRUD error:', error);
    return tasks || [];
  }

  const byId = new Map((employees || []).map((employee) => [employee.id, employee]));
  return (tasks || []).map((task) => ({
    ...task,
    assignee: byId.get(task.assigned_to) || null,
    assigner: byId.get(task.assigned_by) || null,
  }));
}

export async function listMyTasks(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return [];

  if (process.env.NODE_ENV === 'development') {
    console.log('Logged in employee email:', normalizedEmail);
  }

  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_BASE_SELECT)
    .eq('assigned_email', normalizedEmail)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('CRUD error:', error);
    throw error;
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('Fetched tasks:', data);
  }
  return data || [];
}

export function isTaskOverdue(task) {
  if (!task?.due_date) return false;
  if (task.task_status === 'completed') return false;
  const due = new Date(task.due_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

export async function listTasks() {
  let { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  devLog('Fetch response:', { source: 'tasks joined', data, error });

  if (error) {
    console.warn('[taskService] Joined task fetch failed, retrying base query:', error);
    const fallback = await supabase
      .from('tasks')
      .select(TASK_BASE_SELECT)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    data = fallback.data;
    error = fallback.error;
    devLog('Fetch response:', { source: 'tasks fallback', data, error });
  }

  if (error) {
    console.error('CRUD error:', error);
    throw error;
  }

  return hydrateTaskEmployees(data || []);
}

export async function createTask(task, assignedBy, assignee = null) {
  const assigneeEmail = normalizeEmail(assignee?.email || task.assigned_email);
  const assigneeName = assignee?.full_name || task.assigned_name || null;
  const assigneeDepartment = assignee?.department || task.department || null;

  const payload = {
    title: task.title,
    description: task.description || null,
    assigned_to: task.assigned_to || assignee?.id || null,
    assigned_email: assigneeEmail || null,
    assigned_name: assigneeName,
    assigned_by: assignedBy,
    priority: task.priority || 'medium',
    difficulty: Number.isFinite(Number(task.difficulty)) ? Number(task.difficulty) : 2,
    due_date: task.due_date || null,
    task_status: task.task_status || 'pending',
    department: assigneeDepartment,
  };

  if (!payload.title) throw new Error('Task title is required.');
  if (!payload.assigned_to && !payload.assigned_email) {
    throw new Error('Assign an employee before creating a task.');
  }

  devLog('Creating task payload:', payload);

  const { data, error } = await supabase
    .from('tasks')
    .insert(payload)
    .select(TASK_BASE_SELECT)
    .single();
  console.log('Fetch response:', { source: 'create task', data, error });
  if (error) {
    console.error('CRUD error:', error);
    throw error;
  }
  return data;
}

export async function updateTask(taskId, patch) {
  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', taskId)
    .select(TASK_SELECT)
    .single();
  devLog('Fetch response:', { source: 'update task', data, error });
  if (error) {
    console.error('CRUD error:', error);
    throw error;
  }
  return data;
}

export async function updateMyTaskStatus(taskId, taskStatus, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('Employee email is required to update task status.');
  }

  const { data, error } = await supabase.rpc('update_my_task_status', {
    p_task_id: taskId,
    p_status: taskStatus,
  });

  if (error) {
    const fallback = await supabase
      .from('tasks')
      .update({ task_status: taskStatus })
      .eq('id', taskId)
      .eq('assigned_email', normalizedEmail)
      .select(TASK_BASE_SELECT)
      .single();
    if (fallback.error) throw fallback.error;
    return fallback.data;
  }

  return data;
}

export async function deleteTask(taskId) {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  devLog('Fetch response:', { source: 'delete task', data: { id: taskId }, error });
  if (error) {
    console.error('CRUD error:', error);
    throw error;
  }
}
