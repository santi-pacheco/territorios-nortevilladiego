import { AccountButton } from '../../shell/AccountSheet';

export function Component() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-2 px-4 py-5">
      <div className="flex items-start justify-between">
        <h1 className="text-display font-bold">Carrito</h1>
        <div className="lg:hidden">
          <AccountButton />
        </div>
      </div>
      <p className="text-body text-ink-soft">Esta sección se está construyendo.</p>
    </main>
  );
}
