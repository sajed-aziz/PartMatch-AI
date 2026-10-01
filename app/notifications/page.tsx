import { redirect } from "next/navigation";
import { getCustomer } from "@/lib/auth";
import Notifications from "./notifications";

export default async function NotificationsPage() {
  const customer = await getCustomer();
  if (!customer) redirect("/sign-in");
  if (customer.IsSeller) redirect("/seller");
  return <Notifications />;
}
