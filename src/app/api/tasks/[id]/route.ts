import { NextRequest, NextResponse } from 'next/server';
import { updateTask, deleteTask, getTask, getScheduledTask, deleteScheduledTask, updateScheduledTask } from '@/lib/db';
import type { TaskResponse, ErrorResponse, UpdateTaskRequest } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    // Try scheduled task first, then regular task
    const scheduledTask = getScheduledTask(id);
    if (scheduledTask) {
      return NextResponse.json({ task: scheduledTask });
    }

    const task = getTask(id);
    if (!task) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Not found' },
        { status: 404 }
      );
    }

    return NextResponse.json<TaskResponse>({ task });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get task' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body = await request.json();

    // Scheduled task PATCH
    const scheduledTask = getScheduledTask(id);
    if (scheduledTask) {
      const {
        name, prompt, priority, notify_on_complete,
        schedule_value,
        bridge_channel_type, bridge_chat_id,
      } = body as {
        name?: string;
        prompt?: string;
        priority?: string;
        notify_on_complete?: number;
        schedule_value?: string;
        bridge_channel_type?: string | null;
        bridge_chat_id?: string | null;
      };

      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (prompt !== undefined) updates.prompt = prompt;
      if (priority !== undefined) updates.priority = priority;
      if (notify_on_complete !== undefined) updates.notify_on_complete = notify_on_complete;
      if (bridge_channel_type !== undefined) updates.bridge_channel_type = bridge_channel_type ?? null;
      if (bridge_chat_id !== undefined) updates.bridge_chat_id = bridge_chat_id ?? null;

      // When schedule_value changes, recalculate next_run
      if (schedule_value !== undefined && schedule_value !== scheduledTask.schedule_value) {
        updates.schedule_value = schedule_value;
        const { parseInterval, getNextCronTime } = await import('@/lib/task-scheduler');
        if (scheduledTask.schedule_type === 'interval') {
          const ms = parseInterval(schedule_value);
          updates.next_run = new Date(Date.now() + ms).toISOString();
        } else if (scheduledTask.schedule_type === 'cron') {
          const next = getNextCronTime(schedule_value);
          if (!next) {
            return NextResponse.json({ error: `Cron "${schedule_value}" has no valid occurrence within 4 years` }, { status: 400 });
          }
          updates.next_run = next.toISOString();
        }
      }

      if (Object.keys(updates).length > 0) {
        updateScheduledTask(id, updates as Partial<import('@/types').ScheduledTask>);
      }
      return NextResponse.json({ task: getScheduledTask(id) });
    }

    // Regular task PATCH
    const existing = getTask(id);
    if (!existing) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    const updated = updateTask(id, body as UpdateTaskRequest);
    if (!updated) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Failed to update task' },
        { status: 500 }
      );
    }

    return NextResponse.json<TaskResponse>({ task: updated });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to update task' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    // Try deleting from scheduled tasks first, then regular tasks
    const deletedScheduled = deleteScheduledTask(id);
    if (deletedScheduled) {
      return NextResponse.json({ success: true });
    }

    const deleted = deleteTask(id);
    if (!deleted) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to delete task' },
      { status: 500 }
    );
  }
}
