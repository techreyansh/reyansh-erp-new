import { supabase } from '../lib/supabaseClient';

const TABLES = {
  templates: 'task_templates',
  instances: 'task_instances',
  submissions: 'task_submissions',
  scores: 'user_scores',
};

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const taskComplianceService = {
  // ---- Checklist template administration ----
  async listTemplates() {
    const { data, error } = await supabase
      .from(TABLES.templates)
      .select('*')
      .order('department', { ascending: true })
      .order('task_name', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async createTemplate(payload = {}) {
    let createdByEmail = payload.created_by_email || null;
    if (!createdByEmail) {
      try {
        const { data: authData } = await supabase.auth.getUser();
        createdByEmail = authData?.user?.email || null;
      } catch (e) {
        createdByEmail = null;
      }
    }

    const row = {
      task_name: payload.task_name,
      description: payload.description || null,
      department: payload.department,
      task_type: payload.task_type,
      assigned_role_code: payload.assigned_role_code || null,
      assigned_user_id: payload.assigned_user_id || null,
      assigned_email: payload.assigned_email ? normalizeEmail(payload.assigned_email) : null,
      required_proof: Boolean(payload.required_proof),
      scoring_weight: payload.scoring_weight != null ? Number(payload.scoring_weight) : 1,
      is_active: payload.is_active != null ? Boolean(payload.is_active) : true,
      created_by_email: createdByEmail,
    };

    const { data, error } = await supabase
      .from(TABLES.templates)
      .insert(row)
      .select('*')
      .single();
    if (error) {
      console.error('createTemplate error:', error);
      throw error;
    }
    return data;
  },

  async updateTemplate(id, patch = {}) {
    const updates = { ...patch, updated_at: new Date().toISOString() };
    if (Object.prototype.hasOwnProperty.call(updates, 'assigned_email')) {
      updates.assigned_email = updates.assigned_email ? normalizeEmail(updates.assigned_email) : null;
    }
    const { data, error } = await supabase
      .from(TABLES.templates)
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      console.error('updateTemplate error:', error);
      throw error;
    }
    return data;
  },

  async setTemplateActive(id, active) {
    const { data, error } = await supabase
      .from(TABLES.templates)
      .update({ is_active: Boolean(active), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      console.error('setTemplateActive error:', error);
      throw error;
    }
    return data;
  },

  async generateInstances(dateStr) {
    const { data, error } = await supabase.rpc('generate_task_instances_for_date', {
      p_target_date: dateStr,
    });
    if (error) {
      console.error('generateInstances error:', error);
      throw error;
    }
    return data ?? 0;
  },

  async generateForDate(targetDate = null) {
    const payload = targetDate ? { p_target_date: targetDate } : {};
    const { data, error } = await supabase.rpc('generate_task_instances_for_date', payload);
    if (error) throw error;
    return data ?? 0;
  },

  async listTaskInstances({
    date = null,
    userEmail = null,
    department = null,
    taskType = null,
    status = null,
    includeTemplate = true,
  } = {}) {
    let query = supabase
      .from(TABLES.instances)
      .select(
        includeTemplate
          ? '*, task_templates(id, task_name, department, task_type, required_proof, scoring_weight)'
          : '*'
      )
      .order('due_date', { ascending: true });

    if (date) query = query.eq('period_start_date', date);
    if (userEmail) query = query.eq('assigned_to_email', normalizeEmail(userEmail));
    if (status) query = query.eq('status', status);
    if (department) query = query.eq('task_templates.department', department);
    if (taskType) query = query.eq('task_templates.task_type', taskType);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async submitTask(taskInstanceId, { submissionLink = null, submissionNotes = null } = {}) {
    const { data, error } = await supabase.rpc('submit_task_instance', {
      p_task_instance_id: taskInstanceId,
      p_submission_link: submissionLink,
      p_submission_notes: submissionNotes,
    });
    if (error) throw error;
    return data;
  },

  async approveTask(taskInstanceId) {
    const { data, error } = await supabase.rpc('approve_task_instance', {
      p_task_instance_id: taskInstanceId,
    });
    if (error) throw error;
    return data;
  },

  async rejectTask(taskInstanceId, reason = '') {
    const { data, error } = await supabase.rpc('reject_task_instance', {
      p_task_instance_id: taskInstanceId,
      p_reason: reason || null,
    });
    if (error) throw error;
    return data;
  },

  subscribeToTaskRealtime({ onTaskChange, onScoreChange } = {}) {
    const channel = supabase
      .channel('task-compliance-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: TABLES.instances },
        (payload) => onTaskChange?.(payload)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: TABLES.scores },
        (payload) => onScoreChange?.(payload)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};

export default taskComplianceService;
