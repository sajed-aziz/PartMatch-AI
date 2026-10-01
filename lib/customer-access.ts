import { getCustomer } from "@/lib/auth";
import { isSameOrigin, privateJson } from "@/lib/http";

export async function requireCustomer(request?: Request) {
  if (request && !isSameOrigin(request)) {
    return { response: privateJson({ error: "Use the PartMatch website." }, 403) };
  }
  try {
    const customer = await getCustomer();
    if (!customer) return { response: privateJson({ error: "Sign in to continue." }, 401) };
    if (customer.IsSeller) return { response: privateJson({ error: "Customer access is required." }, 403) };
    return { customer };
  } catch {
    return { response: privateJson({ error: "Unable to verify your session." }, 503) };
  }
}
