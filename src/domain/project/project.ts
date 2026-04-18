import { Id } from "../shared/id";
import { ValidationError } from "../shared/errors";

export type ProjectId = Id<"Project">;

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const NAME_MAX = 100;

export interface ProjectSnapshot {
  id: string;
  key: string;
  name: string;
  createdAt: string;
}

/**
 * A Project groups epics and tickets. `key` is a short uppercase code
 * (e.g. "PJM") used to prefix human-readable ticket numbers later.
 */
export class Project {
  private constructor(
    public readonly id: ProjectId,
    public readonly key: string,
    private _name: string,
    public readonly createdAt: Date,
  ) {}

  static create(props: { id?: ProjectId; key: string; name: string; createdAt?: Date }): Project {
    const key = (props.key ?? "").trim().toUpperCase();
    if (!KEY_RE.test(key)) {
      throw new ValidationError(
        "Project key must be 2-10 uppercase letters/digits, starting with a letter",
      );
    }
    const name = props.name?.trim() ?? "";
    if (name.length === 0) throw new ValidationError("Project name must not be empty");
    if (name.length > NAME_MAX)
      throw new ValidationError(`Project name must be at most ${NAME_MAX} characters`);

    return new Project(
      props.id ?? Id.generate<"Project">(),
      key,
      name,
      props.createdAt ?? new Date(),
    );
  }

  get name(): string {
    return this._name;
  }

  rename(name: string): void {
    const trimmed = name?.trim() ?? "";
    if (trimmed.length === 0) throw new ValidationError("Project name must not be empty");
    if (trimmed.length > NAME_MAX)
      throw new ValidationError(`Project name must be at most ${NAME_MAX} characters`);
    this._name = trimmed;
  }

  toSnapshot(): ProjectSnapshot {
    return {
      id: this.id.value,
      key: this.key,
      name: this._name,
      createdAt: this.createdAt.toISOString(),
    };
  }

  static fromSnapshot(s: ProjectSnapshot): Project {
    return new Project(Id.of<"Project">(s.id), s.key, s.name, new Date(s.createdAt));
  }
}
