// The pilot has one shared seller inventory. Never invent contact details.
export function getSellerContact() {
  const phone = process.env.SELLER_CONTACT_PHONE?.trim();
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  return { name: process.env.SELLER_CONTACT_NAME?.trim() || "Participating seller", phone };
}
