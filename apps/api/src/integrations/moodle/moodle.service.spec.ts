import type { MoodleClient } from "./moodle.client";
import { MoodleUnavailableError } from "./moodle.errors";
import { MoodleService } from "./moodle.service";

describe("MoodleService", () => {
  it("usa core_webservice_get_site_info como chequeo de salud", async () => {
    const call = jest.fn().mockResolvedValue({ sitename: "LMS" });
    const service = new MoodleService({ call } as unknown as MoodleClient);

    await expect(service.isHealthy()).resolves.toBe(true);
    expect(call).toHaveBeenCalledWith("core_webservice_get_site_info", {}, expect.anything(), {
      readOnly: true,
    });
  });

  it("publica una sección y un módulo sin reintentos, con el docente y el id del elemento", async () => {
    const call = jest
      .fn()
      .mockResolvedValueOnce({ sectionid: 11, sectionnum: 3, created: true })
      .mockResolvedValueOnce({ cmid: 55, created: false });
    const service = new MoodleService({ call } as unknown as MoodleClient);

    await expect(
      service.publishSection({
        userId: 42,
        courseId: 7,
        itemId: "s-1",
        name: "Unidad 1",
        summary: null,
      }),
    ).resolves.toEqual({ sectionid: 11, sectionnum: 3, created: true });
    await expect(
      service.publishModule({
        userId: 42,
        courseId: 7,
        itemId: "a-1",
        sectionId: 11,
        module: "assign",
        name: "Tarea",
        intro: "Entrega",
        dueDate: "2026-12-04",
      }),
    ).resolves.toEqual({ cmid: 55, created: false });

    expect(call).toHaveBeenNthCalledWith(
      1,
      "local_ai_assistant_publish_section",
      { userid: 42, courseid: 7, itemid: "s-1", name: "Unidad 1", summary: "" },
      expect.anything(),
      { readOnly: false },
    );
    expect(call).toHaveBeenNthCalledWith(
      2,
      "local_ai_assistant_publish_module",
      {
        userid: 42,
        courseid: 7,
        itemid: "a-1",
        sectionid: 11,
        modname: "assign",
        name: "Tarea",
        intro: "Entrega",
        duedate: "2026-12-04",
      },
      expect.anything(),
      { readOnly: false },
    );
  });

  it("propaga el error para que el registro de salud lo marque como caído", async () => {
    const call = jest.fn().mockRejectedValue(new MoodleUnavailableError("caído", "f"));
    const service = new MoodleService({ call } as unknown as MoodleClient);

    await expect(service.isHealthy()).rejects.toBeInstanceOf(MoodleUnavailableError);
  });
});
