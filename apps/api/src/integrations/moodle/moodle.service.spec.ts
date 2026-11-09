import type { MoodleClient } from "./moodle.client";
import { MoodleUnavailableError } from "./moodle.errors";
import { MoodleService } from "./moodle.service";

describe("MoodleService", () => {
  it("usa core_webservice_get_site_info como chequeo de salud", async () => {
    const call = jest.fn().mockResolvedValue({ sitename: "LMS" });
    const service = new MoodleService({ call } as unknown as MoodleClient);

    await expect(service.isHealthy()).resolves.toBe(true);
    expect(call).toHaveBeenCalledWith(
      "core_webservice_get_site_info",
      {},
      expect.anything(),
      { readOnly: true },
    );
  });

  it("propaga el error para que el registro de salud lo marque como caído", async () => {
    const call = jest.fn().mockRejectedValue(new MoodleUnavailableError("caído", "f"));
    const service = new MoodleService({ call } as unknown as MoodleClient);

    await expect(service.isHealthy()).rejects.toBeInstanceOf(MoodleUnavailableError);
  });
});
