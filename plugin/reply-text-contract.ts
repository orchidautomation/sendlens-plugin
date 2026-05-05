type ReplyTextFetchResult = Record<string, unknown> & {
  schema_version: "reply_text_fetch.v1";
};

export function toReplyTextFetchResult(result: Record<string, unknown>): ReplyTextFetchResult {
  const { schema_version: _schemaVersion, ...rest } = result;

  return {
    schema_version: "reply_text_fetch.v1",
    ...rest,
  };
}
