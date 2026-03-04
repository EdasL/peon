import { useCallback, useRef, useState } from 'react';
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  defaultKeyboardCoordinateGetter,
  closestCorners,
} from '@dnd-kit/core';
import type { DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { KanbanTask, TaskStatus } from '../types';
import { COLUMNS } from '../types';

interface UseKanbanDragDropOptions {
  tasks: KanbanTask[];
  setTasksOptimistic: (updater: (prev: KanbanTask[]) => KanbanTask[]) => void;
  reorderTask: (id: string, version: number, targetStatus: TaskStatus, targetIndex: number) => Promise<KanbanTask>;
  onError?: (msg: string) => void;
}

export function useKanbanDragDrop({
  tasks,
  setTasksOptimistic,
  reorderTask,
  onError,
}: UseKanbanDragDropOptions) {
  const [activeTask, setActiveTask] = useState<KanbanTask | null>(null);
  const snapshotRef = useRef<KanbanTask[] | null>(null);

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: defaultKeyboardCoordinateGetter,
  });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  const findColumnForId = useCallback(
    (id: string): TaskStatus | null => {
      if ((COLUMNS as string[]).includes(id)) return id as TaskStatus;
      const task = tasks.find((t) => t.id === id);
      return task?.status ?? null;
    },
    [tasks],
  );

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      if (!task) return;
      setActiveTask(task);
      snapshotRef.current = tasks.map((t) => ({ ...t }));
    },
    [tasks],
  );

  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      const fromColumn = findColumnForId(activeId);
      const toColumn = findColumnForId(overId);
      if (!fromColumn || !toColumn || fromColumn === toColumn) return;

      setTasksOptimistic((prev) => {
        const activeTask = prev.find((t) => t.id === activeId);
        if (!activeTask) return prev;

        const destTasks = prev
          .filter((t) => t.status === toColumn && t.id !== activeId)
          .sort((a, b) => a.columnOrder - b.columnOrder);

        let newIndex = destTasks.length;
        if (!(COLUMNS as string[]).includes(overId)) {
          const overIndex = destTasks.findIndex((t) => t.id === overId);
          if (overIndex >= 0) newIndex = overIndex;
        }

        const updatedTasks = prev.map((t) => {
          if (t.id === activeId) {
            return { ...t, status: toColumn, columnOrder: newIndex };
          }
          return t;
        });

        const destAll = updatedTasks
          .filter((t) => t.status === toColumn)
          .sort((a, b) => {
            if (a.id === activeId) return newIndex - b.columnOrder + 0.5;
            if (b.id === activeId) return a.columnOrder - newIndex - 0.5;
            return a.columnOrder - b.columnOrder;
          });

        const withoutActive = destAll.filter((t) => t.id !== activeId);
        const activeItem = destAll.find((t) => t.id === activeId);
        if (!activeItem) return prev;
        withoutActive.splice(newIndex, 0, activeItem);

        const orderMap = new Map<string, number>();
        withoutActive.forEach((t, i) => orderMap.set(t.id, i));

        return updatedTasks.map((t) => {
          if (t.status === toColumn && orderMap.has(t.id)) {
            return { ...t, columnOrder: orderMap.get(t.id)! };
          }
          return t;
        });
      });
    },
    [findColumnForId, setTasksOptimistic],
  );

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);

      if (!over) {
        if (snapshotRef.current) {
          setTasksOptimistic(() => snapshotRef.current!);
          snapshotRef.current = null;
        }
        return;
      }

      const activeId = active.id as string;
      const overId = over.id as string;

      const originalTask = snapshotRef.current?.find((t) => t.id === activeId);
      if (!originalTask) {
        snapshotRef.current = null;
        return;
      }

      const targetColumn = findColumnForId(overId) ?? originalTask.status;

      const columnTasks = tasks
        .filter((t) => t.status === targetColumn)
        .sort((a, b) => a.columnOrder - b.columnOrder);

      let targetIndex: number;

      if (activeId === overId) {
        targetIndex = columnTasks.findIndex((t) => t.id === activeId);
        if (targetIndex < 0) targetIndex = 0;
      } else if ((COLUMNS as string[]).includes(overId)) {
        targetIndex = columnTasks.filter((t) => t.id !== activeId).length;
      } else {
        const overIndex = columnTasks.findIndex((t) => t.id === overId);
        const activeIndex = columnTasks.findIndex((t) => t.id === activeId);

        if (originalTask.status === targetColumn && activeIndex >= 0 && overIndex >= 0) {
          const reordered = arrayMove(
            columnTasks.map((t) => t.id),
            activeIndex,
            overIndex,
          );
          targetIndex = reordered.indexOf(activeId);
        } else {
          targetIndex = overIndex >= 0 ? overIndex : columnTasks.length;
        }
      }

      if (
        originalTask.status === targetColumn &&
        targetIndex === columnTasks.findIndex((t) => t.id === activeId)
      ) {
        snapshotRef.current = null;
        return;
      }

      setTasksOptimistic((prev) => {
        const colTasks = prev
          .filter((t) => t.status === targetColumn && t.id !== activeId)
          .sort((a, b) => a.columnOrder - b.columnOrder);

        const clamped = Math.max(0, Math.min(targetIndex, colTasks.length));
        const ordered = [...colTasks];
        const moved = prev.find((t) => t.id === activeId);
        if (!moved) return prev;
        ordered.splice(clamped, 0, moved);

        const orderMap = new Map<string, number>();
        ordered.forEach((t, i) => orderMap.set(t.id, i));

        return prev.map((t) => {
          if (t.id === activeId) {
            return { ...t, status: targetColumn, columnOrder: clamped };
          }
          if (t.status === targetColumn && orderMap.has(t.id)) {
            return { ...t, columnOrder: orderMap.get(t.id)! };
          }
          return t;
        });
      });

      try {
        await reorderTask(activeId, originalTask.version, targetColumn, targetIndex);
      } catch (err: unknown) {
        if (snapshotRef.current) {
          setTasksOptimistic(() => snapshotRef.current!);
        }
        const msg =
          err instanceof Error && err.message === 'version_conflict'
            ? 'Task was modified by someone else — board refreshed'
            : 'Failed to move task — reverted';
        onError?.(msg);
      } finally {
        snapshotRef.current = null;
      }
    },
    [tasks, findColumnForId, setTasksOptimistic, reorderTask, onError],
  );

  const onDragCancel = useCallback(() => {
    if (snapshotRef.current) {
      setTasksOptimistic(() => snapshotRef.current!);
    }
    snapshotRef.current = null;
    setActiveTask(null);
  }, [setTasksOptimistic]);

  return {
    sensors,
    collisionDetection: closestCorners,
    activeTask,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
  };
}
