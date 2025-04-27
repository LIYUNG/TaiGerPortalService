const passport = require('passport');
const { Strategy: LocalStrategy } = require('passport-local');
const { Strategy: JwtStrategy } = require('passport-jwt');

const { JWT_SECRET } = require('../config');
const { UserSchema } = require('../models/User');

const getUserModel = (db) => db.models.User || db.model('User', UserSchema);

passport.use(
  new LocalStrategy(
    { usernameField: 'email', passReqToCallback: true },
    async (req, email, password, done) => {
      try {
        const User = getUserModel(req.db);

        const user = await User.findOne({ email }).select('+password');

        if (!user) return done(null, false);

        const isPasswordValid = await user.verifyPassword(password);
        if (!isPasswordValid) return done(null, false);

        if (user.isAccountActivated !== true) {
          return done(null, 'inactivated');
        }
        // Log: login success
        await User.findOneAndUpdate(
          { email },
          { lastLoginAt: new Date() },
          { upsert: false }
        );
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
        const User = getUserModel(req.db);
        const user = await User.findById(payload.id);

        if (!user) return done(null, false);
        // Log: login success
        await User.findByIdAndUpdate(
          payload.id,
          { lastLoginAt: new Date() },
          { upsert: true }
        );
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);
