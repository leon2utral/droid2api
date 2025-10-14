# Request/Response Obfuscation Feature

这个功能允许你在请求和响应过程中对内容进行混淆和反混淆。

## 功能说明

1. **请求混淆**: 当客户端发送请求到代理服务器时，服务器会首先对请求体进行混淆处理，然后再转发给上游API。
2. **响应反混淆**: 当上游API返回响应时，服务器会进行反向替换（反混淆），然后将结果转发给客户端。
3. **支持SSE流式响应**: 对于流式响应（Server-Sent Events），也会实时进行反混淆处理。

## 配置文件

在 `req-replace/req-replace.json` 文件中定义替换规则。格式为键值对，其中：
- **键**: 原始字符串（在请求中会被替换为值）
- **值**: 替换后的字符串（在响应中会被替换回键）

### 示例配置

```json
{
  "secret_key": "public_key",
  "internal_name": "external_name",
  "private_data": "public_data"
}
```

### 工作流程

1. **请求阶段**:
   - 客户端发送: `{"text": "This is a secret_key"}`
   - 混淆后转发: `{"text": "This is a public_key"}`

2. **响应阶段**:
   - 上游返回: `{"response": "Your public_key is valid"}`
   - 反混淆后返回客户端: `{"response": "Your secret_key is valid"}`

## 注意事项

1. 如果 `req-replace.json` 文件不存在，混淆功能会自动禁用。
2. 替换是全局性的，会递归处理所有嵌套的对象和数组。
3. 只有字符串类型的值会被处理。
4. 替换是简单的字符串查找和替换，不支持正则表达式。
5. 替换顺序按照配置文件中定义的顺序执行。

## 使用场景

- 隐藏敏感的内部术语或关键字
- 在客户端和服务器之间使用不同的命名约定
- 对特定内容进行简单的加密/解密（注意：这只是简单的字符串替换，不是真正的加密）

## 禁用功能

如果要禁用混淆功能，只需删除或重命名 `req-replace/req-replace.json` 文件，或将其内容设置为空对象 `{}`。
