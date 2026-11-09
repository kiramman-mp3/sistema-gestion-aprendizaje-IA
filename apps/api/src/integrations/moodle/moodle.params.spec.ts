import { encodeMoodleParams } from "./moodle.params";

describe("encodeMoodleParams", () => {
  it("codifica arreglos y objetos con notación de PHP", () => {
    const encoded = encodeMoodleParams({
      courseids: [2, 3],
      options: [{ name: "includestealth", value: true }],
    });

    expect([...encoded.entries()]).toEqual([
      ["courseids[0]", "2"],
      ["courseids[1]", "3"],
      ["options[0][name]", "includestealth"],
      ["options[0][value]", "1"],
    ]);
  });

  it("omite valores nulos o indefinidos", () => {
    const encoded = encodeMoodleParams({ a: null, b: undefined, c: "x" });
    expect(encoded.toString()).toBe("c=x");
  });

  it("codifica booleanos falsos como 0", () => {
    expect(encodeMoodleParams({ visible: false }).toString()).toBe("visible=0");
  });
});
