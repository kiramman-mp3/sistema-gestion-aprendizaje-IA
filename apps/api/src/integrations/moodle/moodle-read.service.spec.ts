import { MoodleClient } from "./moodle.client";
import { MoodleReadService } from "./moodle-read.service";

function setup(response: unknown) {
  const call = jest.fn(
    async (_fn: string, _params: object, schema: { parse: (v: unknown) => unknown }) =>
      schema.parse(response),
  );
  return { service: new MoodleReadService({ call } as unknown as MoodleClient), call };
}

describe("MoodleReadService", () => {
  it("pide las entregas con el docente, el curso y la actividad, como lectura", async () => {
    const { service, call } = setup({
      cmid: 15,
      truncated: false,
      submissions: [{ studentid: 1, status: "submitted", submittedat: null, late: false }],
    });

    const result = await service.getSubmissions(42, 7, 15);

    expect(call).toHaveBeenCalledWith(
      "local_ai_assistant_get_submissions",
      { userid: 42, courseid: 7, cmid: 15 },
      expect.anything(),
      { readOnly: true },
    );
    expect(result.submissions).toHaveLength(1);
  });

  it("omite cmid cuando no se filtra por actividad", async () => {
    const { service, call } = setup({ truncated: false, pending: [] });

    await service.getPendingGrading(42, 7);

    expect(call).toHaveBeenCalledWith(
      "local_ai_assistant_get_pending_grading",
      { userid: 42, courseid: 7 },
      expect.anything(),
      { readOnly: true },
    );
  });

  it("rechaza una respuesta de Moodle que trae datos personales", async () => {
    const { service } = setup({
      truncated: false,
      students: [{ studentid: 1, fullname: "Ana Pérez" }],
    });

    await expect(service.listStudents(42, 7)).rejects.toThrow();
  });

  it.each([
    ["listActivities", "local_ai_assistant_list_activities", { truncated: false, activities: [] }],
    ["listStudents", "local_ai_assistant_list_students", { truncated: false, students: [] }],
    ["getGrades", "local_ai_assistant_get_grades", { truncated: false, grades: [] }],
    ["getCompletion", "local_ai_assistant_get_completion", { truncated: false, completion: [] }],
    ["getLastAccess", "local_ai_assistant_get_last_access", { truncated: false, lastaccess: [] }],
  ] as const)("%s llama a %s", async (method, wsfunction, response) => {
    const { service, call } = setup(response);

    await (service[method] as (u: number, c: number) => Promise<unknown>)(42, 7);

    expect(call.mock.calls[0]![0]).toBe(wsfunction);
  });
});
