import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { taskSchema } from "../types.js";
import type { Task } from "../types.js";
import type { TaskRepository } from "./task-repository.js";

export class FileSystemTaskRepository implements TaskRepository {
  readonly #tasksDir: string;

  constructor(tasksDir: string) {
    this.#tasksDir = tasksDir;
  }

  async upsertTask(task: Task): Promise<void> {
    await mkdir(this.#tasksDir, { recursive: true });
    await writeFile(
      join(this.#tasksDir, `${task.id}.json`),
      JSON.stringify(task, null, 2),
      "utf-8"
    );
  }

  async findTask(id: string): Promise<Task | null> {
    try {
      const raw = await readFile(join(this.#tasksDir, `${id}.json`), "utf-8");
      const parsed = taskSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async listTasks(storyId: string): Promise<Task[]> {
    let entries: string[];
    try {
      entries = await readdir(this.#tasksDir);
    } catch {
      return [];
    }

    const tasks: Task[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const task = await this.findTask(entry.slice(0, -5));
      if (task !== null && task.story_id === storyId) {
        tasks.push(task);
      }
    }
    return tasks;
  }
}
