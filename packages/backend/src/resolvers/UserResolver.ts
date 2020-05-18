import axios from 'axios';
import { Resolver, Ctx, Mutation, Arg, FieldResolver, Root, Authorized, Query, Args } from 'type-graphql';
import { User, AuthType, GrantType } from '../entity/User';
import { Context } from '../types';
import Result from './types/Result';
import { Organization } from '../entity/Organization';
import SignInResult from './types/SignInResult';
import { OrganizationMembership } from '../entity/OrganizationMembership';
import { PasswordReset } from '../entity/PasswordReset';
import { APIKeyConnection } from './APIKeyResolver';
import { ConnectionArgs } from './types/Pagination';

// TODO: We should probably separate out things that are associated with the "user" (me query, enable/disable totp, updateAccount)
// from things that are associated purely with auth (signup, signin, exchangetotp, forgot password, reset password)

@Resolver(() => User)
export class UserResolver {
    @Authorized()
    @Query(() => User)
    async viewer(@Ctx() { user }: Context): Promise<User> {
        return user;
    }

    // TODO: Add a decorator for "CurrentUserOnly" to mark that this is only
    // fetched on the current user.
    @FieldResolver()
    hasTOTP(@Ctx() { user }: Context): boolean {
        return !!user.totpSecret;
    }

    @FieldResolver(() => APIKeyConnection)
    async apiKeys(@Ctx() { user }: Context, @Args() _args: ConnectionArgs) {
        return {
            edges: (await user.apiKeys).map(key => ({ node: key, cursor: key.id })),
            pageInfo: { hasNextPage: false, hasPreviousPage: false },
        };
        // return this.apiKeyRepo.findAndCount({
        //     where: {
        //         user,
        //     },
        //     take: limit,
        //     skip: offset,
        // });
    }

    @Mutation(() => Result)
    async signUp(
        @Arg('username') username: string,
        @Arg('name') name: string,
        @Arg('email') email: string,
        @Arg('password') password: string,
    ) {
        await User.signUp({
            username,
            name,
            email,
            password,
        });

        return new Result();
    }

    @Mutation(() => SignInResult)
    async signIn(@Arg('email') email: string, @Arg('password') password: string) {
        const user = await User.findOne({ where: { email } });

        if (!user) {
            throw new Error('No user found.');
        }

        const passwordValid = await user.checkPassword(password);

        if (!passwordValid) {
            throw new Error('Invalid password.');
        }

        // TODO: Move this into the User itself:
        // Remove any password reset so that it is no longer valid after signing in:
        PasswordReset.removeForUser(user);

        if (user.totpSecret) {
            user.signIn(AuthType.TOTP);

            return new SignInResult(true);
        }

        user.signIn();

        return new SignInResult(false);
    }

    @Mutation(() => SignInResult)
    async gitHubSignIn(@Arg('code') code: string) {
        const params = {
            client_id: 'c30bdab49350c27729d7',
            client_secret: 'fa7330d0ae21de0c4c50f33caf954b669f5a69c8',
            code,
        };

        const res = await axios.post('https://github.com/login/oauth/access_token', params, {
            headers: {
                Accept: 'application/json',
            },
        });

        const githubUser = await axios.post(
            'https://api.github.com/graphql',
            {
                query: `
                query {
                    viewer {
                        id
                        login
                        email
                        name
                    }
                }
            `,
            },
            {
                headers: {
                    Authorization: `bearer ${res.data.access_token}`,
                },
            },
        );

        const { viewer } = githubUser.data.data;

        const user = await User.findOne({
            where: {
                githubID: viewer.id,
                email: viewer.email,
            },
        });

        if (!user) {
            // TODO: What do we do about the username here?
            await User.signUp({
                username: viewer.login,
                githubID: viewer.id,
                name: viewer.name,
                email: viewer.email,
            });

            return new SignInResult(false);
        }

        // If the user is not passwordless, then we need to prevent them from
        // signing in with just github.
        if (!user.isPasswordless) {
            // TODO: Refine the error message:
            throw new Error('User account is not passwordless.');
        }

        // TODO: Move this into the User itself:
        // Remove any password reset so that it is no longer valid after signing in:
        PasswordReset.removeForUser(user);

        if (user.totpSecret) {
            user.signIn(AuthType.TOTP);

            return new SignInResult(true);
        }

        user.signIn();

        return new SignInResult(false);
    }

    // TODO: Transaction
    @Authorized(GrantType.SESSION)
    @Mutation(() => User)
    async updateAccount(
        @Ctx() { user }: Context,
        @Arg('username', { nullable: true }) username?: string,
        @Arg('name', { nullable: true }) name?: string,
        @Arg('email', { nullable: true }) email?: string,
    ) {
        if (username) {
            user.username = username;
            const personalOrganization = await user.personalOrganization;
            personalOrganization.username = username;
            personalOrganization.save();
        }

        if (name) {
            user.name = name;
        }

        if (email) {
            user.email = email;
        }

        return await user.save();
    }

    @Mutation(() => Result)
    async forgotPassword(@Arg('email') email: string) {
        await PasswordReset.createForEmail(email);

        return new Result();
    }

    // TODO: Why is this on the user and not just a Query method.
    // TODO: Should we just bite the bullet and make personal organizations returned at
    // the top-level as well. (this would move to be a client concern)
    @FieldResolver(() => [Organization])
    async organizations(@Root() user: User) {
        const memberships = await OrganizationMembership.find({
            where: {
                user: user,
            },
            relations: ['organization'],
        });

        // TODO: This won't work when we have external collaborators.
        return memberships
            .map(membership => membership.organization)
            .filter(org => !org.isPersonal);
    }

    // TODO: Transaction:
    @Mutation(() => Result)
    async resetPassword(@Arg('uuid') uuid: string, @Arg('password') password: string) {
        const reset = await PasswordReset.findOne({
            where: { uuid },
            relations: ['user'],
        });

        // TODO: Validate that the date that the password reset was created is with # of days:
        if (!reset) {
            throw new Error('Invalid password reset.');
        }

        if (password) {
            const user = await User.fromSession(AuthType.PASSWORD_RESET);

            if (!user) {
                throw new Error('Did not find a started password reset.');
            }

            // TODO: Why is this commented out??
            // await reset.remove();

            await user.setPassword(password);
            await user.save();

            user.signIn();
            return new Result();
        }

        reset.user.signIn(AuthType.PASSWORD_RESET);

        return new Result();
    }

    @Authorized(GrantType.SESSION)
    @Mutation(() => Result)
    signOut(@Ctx() { user, destroySession }: Context) {
        user.signOut();
        destroySession();
        return new Result();
    }
}
