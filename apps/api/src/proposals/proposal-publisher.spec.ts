import {
  MoodleApiError,
  MoodleAuthError,
  MoodlePermissionError,
  MoodleResponseError,
  MoodleUnavailableError,
} from "../integrations/moodle/moodle.errors";
import { describeFailure, MODULE_OF_ITEM_TYPE } from "./proposal-publisher";

describe("describeFailure", () => {
  it("resume cada causa en un código que no revela datos internos", () => {
    expect(describeFailure(new MoodlePermissionError("f", "nopermissions", "x"))).toBe(
      "MOODLE_PERMISSION",
    );
    expect(describeFailure(new MoodleUnavailableError("caído", "f"))).toBe("MOODLE_UNAVAILABLE");
    expect(describeFailure(new MoodleApiError("f", "invalidparameter", "texto interno"))).toBe(
      "MOODLE_ERROR:invalidparameter",
    );
    expect(describeFailure(new MoodleResponseError("sin forma", "f"))).toBe("MOODLE_BAD_RESPONSE");
    expect(describeFailure(new MoodleAuthError("f", "invalidtoken", "x"))).toBe(
      "MOODLE_ERROR:invalidtoken",
    );
    expect(describeFailure(new Error("cualquier otra cosa"))).toBe("PUBLISH_ERROR");
  });

  it("no incluye el mensaje de Moodle", () => {
    const reason = describeFailure(new MoodleApiError("f", "dml", "SELECT * FROM secretos"));

    expect(reason).not.toContain("SELECT");
  });
});

describe("MODULE_OF_ITEM_TYPE", () => {
  it("cada tipo de elemento de la propuesta tiene su módulo de Moodle (D-05 provisional)", () => {
    expect(MODULE_OF_ITEM_TYPE).toEqual({
      ASSIGN: "assign",
      FORUM: "forum",
      QUIZ: "quiz",
      LABEL: "label",
      PAGE: "page",
    });
  });
});
