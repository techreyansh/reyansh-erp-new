import { supabase } from '../lib/supabaseClient';

const TASK_SELECT = `
  id,
  title,
  description,
  assigned_to,
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

export async function listTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createTask(task, assignedBy) {
  const payload = {
    title: task.title,
    description: task.description || null,
    assigned_to: task.assigned_to || null,
    assigned_by: assignedBy,
    priority: task.priority || 'medium',
    due_date: task.due_date || null,
    task_status: task.task_status || 'pending',
    department: task.department || null,
  };

  if (!payload.title) throw new Error('Task title is required.');
  if (!payload.assigned_to) throw new Error('Assign an employee before creating a task.');

  const { data, error } = await supabase
    .from('tasks')
    .insert(payload)
    .select(TASK_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function updateTask(taskId, patch) {
  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', taskId)
    .select(TASK_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function updateMyTaskStatus(taskId, taskStatus) {
  return updateTask(taskId, { task_status: taskStatus });
}

export async function deleteTask(taskId) {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  if (error) throw error;
}
