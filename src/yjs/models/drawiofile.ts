/**
 * 和drawiofile的转换
 * 
 */
import * as Y from 'yjs'

export function parse(xml: string): Y.Array<any> {
    // 标记参数已使用，满足 noUnusedParameters
    void xml;
    const array = new Y.Array<any>();
    // array.push(xml);
    return array;
}

export function serialize(file: Y.Array<any>): string {
    // 标记参数已使用，满足 noUnusedParameters
    void file;
    // TODO: 将 Y.Array 内容序列化为 drawio XML
    return '';
}