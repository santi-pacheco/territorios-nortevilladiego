-- Why a turn is blocked: shown on the banner over the blocked cell ("Asamblea", "Sin carrito").
-- Nullable so existing blackouts stay valid; the table keeps its RLS (public read, editor write).
alter table public.cart_blackouts
  add column reason text
  constraint cart_blackouts_reason_len check (reason is null or char_length(reason) <= 60);

comment on column public.cart_blackouts.reason is
  'Optional label for the banner over the blocked turn (max 60 chars).';
