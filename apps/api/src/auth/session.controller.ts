import { Controller, Get } from "@nestjs/common";
import { Auth, type AuthContext } from "./auth-context";

@Controller("session")
export class SessionController {
  /** Identidad verificada del usuario. Sirve al plugin para comprobar la conexión con el backend. */
  @Get()
  get(@Auth() auth: AuthContext): AuthContext {
    return auth;
  }
}
