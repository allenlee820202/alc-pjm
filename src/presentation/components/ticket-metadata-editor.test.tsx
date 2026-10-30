import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TicketMetadataEditor } from "./ticket-metadata-editor";
import { TicketMetadataDisplay } from "./ticket-metadata-display";
import { ticketMetadataFromForm } from "../ticket-metadata-form";

const origin = {system: "alc-agent" as const, automationId: "daily", automationRevision: "rev", runId: "run", approvalId: "approval"};

describe("metadata editors and display", () => {
  it("edits tags/annotations as JSON, shows validation errors and never offers origin editing", () => {
    render(<form><TicketMetadataEditor tags={["tag"]} annotations={{"a.b": "value"}} origin={origin} /></form>);
    expect(screen.getByLabelText("Tags (JSON array)")).toHaveValue('["tag"]');
    fireEvent.change(screen.getByTestId("metadata-tags"), {target: {value: '["duplicate","duplicate"]'}});
    expect(screen.getByRole("alert")).toHaveTextContent("unique");
    expect(screen.getByTestId("metadata-tags")).toBeInvalid();
    fireEvent.change(screen.getByTestId("metadata-tags"), {target: {value: '[]'}});
    fireEvent.change(screen.getByTestId("metadata-annotations"), {target: {value: '{"__proto__":"bad"}'}});
    expect(screen.getByRole("alert")).toHaveTextContent("Forbidden");
    fireEvent.change(screen.getByTestId("metadata-annotations"), {target: {value: '{}'}});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("metadata-tags")).toBeValid();
    expect(screen.queryByLabelText(/Origin/)).toBeNull();
  });

  it("displays literal annotations, tags and immutable origin as escaped text", () => {
    render(<TicketMetadataDisplay tags={["triage"]} annotations={{"a.b": "<script>x</script>"}} origin={origin} />);
    expect(screen.getByLabelText("Tags")).toHaveTextContent("triage");
    expect(screen.getByLabelText("Annotations")).toHaveTextContent("a.b: <script>x</script>");
    expect(screen.getByTestId("ticket-origin")).toHaveTextContent("approval");
    expect(screen.getByTestId("ticket-origin")).toHaveTextContent("not an authorization credential");
    expect(document.querySelector("script")).toBeNull();
  });

  it("server form adapter parses/validates metadata but cannot take editable origin", () => {
    const form = new FormData();
    expect(ticketMetadataFromForm(form)).toEqual({});
    expect(ticketMetadataFromForm(form, "create")).toEqual({tags: [], annotations: {}});
    form.set("tagsJson", "[]"); expect(ticketMetadataFromForm(form)).toEqual({tags: []});
    form.delete("tagsJson"); form.set("annotationsJson", "{}");
    expect(ticketMetadataFromForm(form)).toEqual({annotations: {}});
    form.set("tagsJson", '[" tag "]'); form.set("annotationsJson", '{"a.b":"value"}');
    form.set("origin", JSON.stringify(origin));
    expect(ticketMetadataFromForm(form)).toEqual({tags: ["tag"], annotations: {"a.b": "value"}});
    form.set("tagsJson", "broken"); expect(() => ticketMetadataFromForm(form)).toThrow(/valid JSON/);
  });
});
