import { getCustomer } from "@/lib/auth";
import { isSameOrigin, privateJson } from "@/lib/http";

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireAccess(request?: Request, sellerOnly = false) {
  if (request && !isSameOrigin(request)) {
    return { response: privateJson({ error: "Use the PartMatch website." }, 403) };
  }
  try {
    const customer = await getCustomer();
    if (!customer) return { response: privateJson({ error: "Sign in to continue." }, 401) };
    if (sellerOnly && !customer.IsSeller) {
      return { response: privateJson({ error: "Seller access is required." }, 403) };
    }
    return { customer };
  } catch {
    return { response: privateJson({ error: "Unable to verify your session." }, 503) };
  }
}

// Sellers may review only requests with explicit sharing consent; customers
// may read only their own requests. Missing and unauthorized IDs both yield 404.
export const requestAccessFilter = `((@isSeller = 0 AND CustomerId = @customerId) OR
  (@isSeller = 1 AND ConsentVersion IS NOT NULL AND ConsentAcceptedAt IS NOT NULL))`;
