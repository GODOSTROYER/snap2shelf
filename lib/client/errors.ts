import type { ApiError } from "../api-contract";

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.error);
    this.name = "ApiFailure";
  }
}
