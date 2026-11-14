// Doble de `core/notification` de Moodle: la prueba decide si el docente confirma o cancela el diálogo.
export const confirmation = { accept: true, calls: [] };

export const deleteCancelPromise = async (title, question, deleteLabel) => {
  confirmation.calls.push({
    title: await title,
    question: await question,
    deleteLabel: await deleteLabel,
  });
  if (!confirmation.accept) throw new Error("cancelado");
};
