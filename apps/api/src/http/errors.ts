/**
 * One error type, one wire shape.
 *
 * Routes throw; a single handler turns that into a response. The alternative --
 * every route assembling its own error body -- is how a client ends up with
 * four different ways to discover it is unauthenticated.
 *
 * The `message` is for whoever reads the logs. Anything a user should see is
 * chosen by the client from `code`, because the client knows the language and
 * the screen and we do not.
 */

import { ERROR_CODES, type ApiError, type ErrorCode } from "@whosonbreak/contracts";

export class ApiProblem extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string[]>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiProblem";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  toBody(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
      },
    };
  }
}

export const badRequest = (message: string, fields?: Record<string, string[]>) =>
  new ApiProblem(400, ERROR_CODES.validationFailed, message, fields);

export const unauthenticated = (message = "Sign in required") =>
  new ApiProblem(401, ERROR_CODES.unauthenticated, message);

/**
 * Used for "you may not", never for "does not exist". Deliberately also used
 * where a 404 would be more literally true but would leak whether a group or a
 * user exists to someone guessing ids.
 */
export const forbidden = (message = "Not allowed") =>
  new ApiProblem(403, ERROR_CODES.forbidden, message);

export const notFound = (message = "Not found") =>
  new ApiProblem(404, ERROR_CODES.notFound, message);

export const conflict = (message: string) =>
  new ApiProblem(409, ERROR_CODES.conflict, message);

export const groupFull = (message = "This group is full") =>
  new ApiProblem(409, ERROR_CODES.groupFull, message);

export const rateLimited =(message = "Too many requests") =>
  new ApiProblem(429, ERROR_CODES.rateLimited, message);

export const internal = (message = "Something went wrong") =>
  new ApiProblem(500, ERROR_CODES.internal, message);
