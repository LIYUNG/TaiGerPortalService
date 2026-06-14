import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as JwtStrategy } from 'passport-jwt';

import { JWT_SECRET } from '../config';
import UserService from '../services/users';

passport.use(
  new LocalStrategy(
    { usernameField: 'email', passReqToCallback: true },
    async (req, email, password, done) => {
      try {
        const user = await UserService.getUserDocWithPasswordByEmail(email);

        if (!user) return done(null, false);

        const isPasswordValid = await user.verifyPassword(password);
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
