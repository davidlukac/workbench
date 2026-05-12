import type { Task } from "../types.js";
import type { TaskRepository } from "./task-repository.js";

export class MemoryTaskRepository implements TaskRepository {
  readonly #tasks = new Map<string, Task>();

  async upsertTask(task: Task): Promise<void> {
    this.#tasks.set(task.id, structuredClone(task));
  }

  async findTask(id: string): Promise<Task | null> {
    return structuredClone(this.#tasks.get(id) ?? null);
  }

  async listTasks(storyId: string): Promise<Task[]> {
    return [...this.#tasks.values()]
      .filter((t) => t.story_id === storyId)
      .map((t) => structuredClone(t));
  }
}
