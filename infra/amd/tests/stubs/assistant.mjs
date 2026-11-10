// Doble de `local_ai_assistant/assistant`: las pruebas deciden qué responde el backend.
export const backend = { calls: [], handler: async () => ({}) };

export const callBackend = async (courseId, path, options = {}) => {
  const call = { courseId, path, method: options.method || "GET", json: options.json };
  backend.calls.push(call);
  return backend.handler(call);
};
