import { redirect } from "next/navigation";
import { getCustomer } from "@/lib/auth";
import MyRequests from "./my-requests";

export default async function MyRequestsPage() {
  const customer = await getCustomer();
  if (customer?.IsSeller) redirect("/seller");
  return <MyRequests />;
}
