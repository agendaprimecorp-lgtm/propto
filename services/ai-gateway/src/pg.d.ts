// `pg` é dependência opcional e só é importada dinamicamente em index.ts.
// Esta declaração evita exigir @types/pg no build padrão do gateway.
declare module 'pg';
