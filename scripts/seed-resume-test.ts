// One-shot seed: creates a cart_created printOrder for the given
// USER_ID so the Resume button has a row to act on. Runs outside the
// server-only db wrapper by importing the driver directly.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";

const USER_ID = process.env.SEED_USER_ID ?? "user_3CPTvFsQSsMvUnk3SQ89gvSlooD";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema });
  const { users, files, fileAssets, printOrders } = schema;

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, USER_ID));
  if (!existingUser) {
    await db.insert(users).values({
      id: USER_ID,
      username: "claudetest",
      displayName: "Claude Test",
    });
    console.log("Created users row");
  } else {
    console.log("Users row already exists");
  }

  const [file] = await db
    .insert(files)
    .values({
      userId: USER_ID,
      name: "Resume Test Model",
      slug: `resume-test-${Date.now()}`,
      price: 0,
      license: "free",
      status: "published",
      visibility: "private",
    })
    .returning();

  const [asset] = await db
    .insert(fileAssets)
    .values({
      fileId: file.id,
      storageKey: `uploads/${USER_ID}/seed/resume-test.stl`,
      originalFilename: "resume-test.stl",
      format: "stl",
      fileUnit: "mm",
      fileSize: 1024,
      contentHash: "seedhash_resume_test",
    })
    .returning();

  const [order] = await db
    .insert(printOrders)
    .values({
      userId: USER_ID,
      fileAssetId: asset.id,
      craftCloudCartId: "seed-cart-123",
      totalPrice: 5000,
      serviceFee: 150,
      material: "PLA White",
      vendor: "seed-vendor",
      status: "cart_created",
      shippingAddress: {
        email: "claudetest+clerk_test@example.com",
        shipping: {
          firstName: "Claude",
          lastName: "Test",
          address: "1 Test St",
          city: "Portland",
          zipCode: "97201",
          stateCode: "OR",
          countryCode: "US",
        },
        billing: {
          firstName: "Claude",
          lastName: "Test",
          address: "1 Test St",
          city: "Portland",
          zipCode: "97201",
          stateCode: "OR",
          countryCode: "US",
          isCompany: false,
        },
      },
    })
    .returning();

  console.log(JSON.stringify({ orderId: order.id, fileAssetId: asset.id }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
