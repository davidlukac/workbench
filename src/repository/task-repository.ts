import type { Task } from "../types.js";

export interface TaskRepository {
  upsertTask(task: Task): Promise<void>;
  findTask(id: string): Promise<Task | null>;
  listTasks(storyId: string): Promise<Task[]>;
}
