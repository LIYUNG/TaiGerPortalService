import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as JwtStrategy } from 'passport-jwt';

import { JWT_SECRET } from '../config';
import UserService from '../services/users';

// `verifyPassword` is attached to the User model at runtime via
// `UserSchema.methods.verifyPassword = ...` (models/User.ts), which bypasses
// the schema's static (generated) document typing. This narrow shape lets us
// call it without widening the type of `user` itself (still needed below for
// `done(null, user)` and the other UserService calls).
interface UserDocumentWithVerify {
  verifyPassword(password: string): Promise<boolean>;
}

passport.use(
  new LocalStrategy(
    { usernameField: 'email', passReqToCallback: true },
    async (req, email, password, done) => {
      try {
        const user = await UserService.getUserDocWithPasswordByEmail(email);

        if (!user) return done(null, false);

        const isPasswordValid = await (
          user as unknown as UserDocumentWithVerify
        ).verifyPassword(password);
        if (!isPasswordValid) return done(null, false);

        if (user.isAccountActivated !== true) {
          return done(null, 'inactivated');
        }
        // Log: login success
        await UserService.touchLastLoginByEmail(email);
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.use(
  new JwtStrategy(
    {
      secretOrKey: JWT_SECRET,
      jwtFromRequest: (req) => req.cookies['x-auth'],
      passReqToCallback: true
    },
    async (req, payload, done) => {
      try {
        const user = await UserService.getUserDocById(payload.id);

        if (!user) return done(null, false);
        // Log: login success
        await UserService.touchLastLoginById(payload.id);
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);
