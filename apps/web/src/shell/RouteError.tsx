import { isRouteErrorResponse, useRouteError } from 'react-router';

export function RouteError() {
  const error = useRouteError();
  const chunkFailed =
    error instanceof Error && /dynamically imported module|Failed to fetch/i.test(error.message);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 bg-canvas p-6 text-ink">
      <h1 className="text-title font-bold">
        {chunkFailed ? 'Esta sección no se pudo cargar' : 'Algo salió mal'}
      </h1>
      <p className="text-body text-ink-soft">
        {chunkFailed
          ? 'Revisá la conexión y volvé a intentar. Las salidas ya cargadas siguen disponibles.'
          : isRouteErrorResponse(error)
            ? `${error.status} ${error.statusText}`
            : 'Volvé a intentar. Si sigue pasando, avisale a un encargado.'}
      </p>
      <button type="button" className="btn-primary self-start" onClick={() => location.reload()}>
        Volver a intentar
      </button>
    </main>
  );
}
