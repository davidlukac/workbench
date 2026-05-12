import type { Logger } from "../logging/logger.js";
import type { Task } from "../types.js";
import type { TaskRepository } from "./task-repository.js";

export class MultiChannelTaskRepository implements TaskRepository {
  readonly #logger: Logger;
  readonly #primary: TaskRepository;
  readonly #secondaries: readonly TaskRepository[];

  constructor(logger: Logger, primary: TaskRepository, ...secondaries: TaskRepository[]) {
    this.#logger = logger;
    this.#primary = primary;
    this.#secondaries = secondaries;
  }

  async findTask(id: string): Promise<Task | null> {
    return this.#primary.findTask(id);
  }

  async listTasks(storyId: string): Promise<Task[]> {
    return this.#primary.listTasks(storyId);
  }

  async upsertTask(task: Task): Promise<void> {
    await this.#primary.upsertTask(task);
    for (const secondary of this.#secondaries) {
      await secondary.upsertTask(task).catch((err: unknown) => {
        void this.#logger.error("repository_secondary_write_failed", {
          method: "upsertTask",
          error: String(err)
        });
      });
    }
  }
}
