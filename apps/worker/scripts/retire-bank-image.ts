// Retire one picture-library row by id (TEACH-84): it is never served again and kept for audit.
//   DATABASE_URL=… bun apps/worker/scripts/retire-bank-image.ts <bank_images.id>
import { createDb, retireBankImage } from "@tj/db";

const id = process.argv[2];
if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
  console.error("usage: retire-bank-image.ts <bank_images.id>");
  process.exit(2);
}
const { unsafeDb, close } = createDb(process.env.DATABASE_URL ?? "");
try {
  const changed = await retireBankImage(unsafeDb, id);
  console.log(changed ? `retired ${id}` : `no row ${id}`);
  process.exitCode = changed ? 0 : 1;
} finally {
  await close();
}
