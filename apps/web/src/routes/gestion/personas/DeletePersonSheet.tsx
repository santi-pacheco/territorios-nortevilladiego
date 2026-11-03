/**
 * Confirm dialog for deleting a person (admin only). The server refuses while the person is still
 * linked to a program, privilegios cell, salida, carrito assignment or account; the reason is shown
 * here and nothing is rewritten behind the schedule's back.
 */
import { useDeletePerson, type PersonRow } from '@territorios/data';
import { Sheet } from '../carrito/ui';
import { deleteErrorMessage } from './model';

export function DeletePersonSheet({ person, onClose }: { person: PersonRow; onClose: () => void }) {
  const remove = useDeletePerson();

  return (
    <Sheet title={`Borrar a ${person.name}`} onClose={onClose}>
      <p className="max-w-prose text-body">
        Se borra del directorio, con su disponibilidad y sus parejas del carrito. No se puede borrar
        si todavía figura en el programa, las salidas, los privilegios, el carrito o una cuenta:
        primero hay que reemplazarla ahí.
      </p>
      {remove.isError && (
        <p role="alert" className="text-secondary text-danger">
          {deleteErrorMessage(remove.error, person.name)}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ id: person.id }, { onSuccess: onClose })}
        >
          {remove.isPending ? 'Borrando…' : 'Borrar persona'}
        </button>
      </div>
    </Sheet>
  );
}
