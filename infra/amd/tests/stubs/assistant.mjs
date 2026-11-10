// Doble de `local_ai_assistant/assistant`: las pruebas deciden qué responde el backend.
export const backend = { calls: [], handler: async () => ({}) };

export const callBackend = async (courseId, path, options = {}) => {
  const call = {
    courseId,
    path,
    method: options.method || "GET",
    json: options.json,
    headers: options.headers,
  };
  backend.calls.push(call);
  return backend.handler(call);
};

/** Flujo simulado del chat: la prueba decide qué eventos llegan o qué error ocurre. */
export const stream = { calls: [], handler: async () => {} };

export const streamBackend = async (courseId, path, options) => {
  stream.calls.push({ courseId, path, json: options.json, signal: options.signal });
  return stream.handler({ courseId, path, ...options });
};

/** Nombres de los estudiantes que Moodle entrega por AJAX; `null` simula un fallo. */
export const students = { list: [], fails: false };

export const getCourseStudents = async () => {
  if (students.fails) throw new Error("ajax");
  return students.list;
};
