import { createContext } from "@lit/context";
import { redirect, type Guard } from "lit-canon-composition";

export class AuthService {
  user: string | undefined;

  login(user: string) {
    this.user = user;
  }

  logout() {
    this.user = undefined;
  }
}

export const authCtx = createContext<AuthService>("auth-service");

/** Sends anonymous users to the login page and back afterwards. */
export const requireAuth: Guard = ({ container, path }) =>
  container.get(authCtx).user ? true : redirect(`/login?next=${encodeURIComponent(path)}`);
