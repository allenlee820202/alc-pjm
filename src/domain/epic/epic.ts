import { Id } from "../shared/id";
import { ValidationError } from "../shared/errors";

export type EpicId = Id<"Epic">;
export type ProjectId = Id<"Project">;

const NAME_MAX = 150;

export interface EpicSnapshot {
  id: string;
  projectId: string;
  name: string;
  description: string;
  createdAt: string;
}

/**
 * An Epic groups related tickets within a project. Used to "categorize different
 * projects" of work, e.g. "Onboarding", "Billing v2".
 */
export class Epic {
  private constructor(
    public readonly id: EpicId,
    public readonly projectId: ProjectId,
    private _name: string,
    private _description: string,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id?: EpicId;
    projectId: ProjectId;
    name: string;
    description?: string;
    createdAt?: Date;
  }): Epic {
    const name = props.name?.trim() ?? "";
    if (name.length === 0) throw new ValidationError("Epic name must not be empty");
    if (name.length > NAME_MAX)
      throw new ValidationError(`Epic name must be at most ${NAME_MAX} characters`);
    return new Epic(
      props.id ?? Id.generate<"Epic">(),
      props.projectId,
      name,
      props.description?.trim() ?? "",
      props.createdAt ?? new Date(),
    );
  }

  get name(): string {
    return this._name;
  }
  get description(): string {
    return this._description;
  }

  rename(name: string): void {
    const trimmed = name?.trim() ?? "";
    if (trimmed.length === 0) throw new ValidationError("Epic name must not be empty");
    if (trimmed.length > NAME_MAX)
      throw new ValidationError(`Epic name must be at most ${NAME_MAX} characters`);
    this._name = trimmed;
  }

  toSnapshot(): EpicSnapshot {
    return {
      id: this.id.value,
      projectId: this.projectId.value,
      name: this._name,
      description: this._description,
      createdAt: this.createdAt.toISOString(),
    };
  }

  static fromSnapshot(s: EpicSnapshot): Epic {
    return new Epic(
      Id.of<"Epic">(s.id),
      Id.of<"Project">(s.projectId),
      s.name,
      s.description,
      new Date(s.createdAt),
    );
  }
}
