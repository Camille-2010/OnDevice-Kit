import json

path = r'F:\pp\src\locales\zh.json'
with open(path, encoding='utf-8') as f:
    zh = json.load(f)

# 缺失 key -> 中文翻译
additions = {
    'settings.purchases.title': '购买',
    'settings.purchases.statusOwned': '已购买',
    'settings.purchases.statusUnlocking': '正在解锁',
    'settings.purchases.link': '登录以在其他设备上使用',
    'components.bubble.promptTokensPerSec': '{{value}} 提示词令牌/秒',
    'components.bubble.cachedTokens': '{{value}} 已缓存',
    'components.completionSettings.serverDefault': '服务器默认值',
    'components.completionSettings.usingServerDefault': '使用服务器默认值：{{value}}',
    'components.completionSettings.usingServerDefaultUnreported': '使用服务器默认值（未上报）',
    'components.completionSettings.resetToServerDefault': '服务器默认值：{{value}} · 重置',
    'components.completionSettings.resetToServerDefaultAccessibilityLabel': '将 {{name}} 重置为服务器默认值 {{value}}',
    'palsScreen.purchase.buy': '{{price}}',
    'palsScreen.purchase.open': '打开',
    'palsScreen.purchase.install': '安装',
    'palsScreen.purchase.pending': '待处理',
    'palsScreen.purchase.unlocking': '正在解锁',
    'palsScreen.purchase.retry': '重试',
    'palsScreen.purchase.supportCode': '支持代码：{{code}}',
    'palsScreen.purchase.noLongerAvailable': '此 Pal 不再可用。您可以{{refundLink}}。',
    'palsScreen.purchase.refundLink': '向 Apple 申请退款',
    'palsScreen.purchase.notCompleted': '此购买未能完成。Google 将为您退款。',
    'palsScreen.purchase.withdrawnRefunding': '此 Pal 已被撤回。请联系支持人员退款。',
    'palsScreen.purchase.invalid': '我们无法验证此购买。',
    'palsScreen.purchase.heldInvalid': '我们无法解锁此购买。请使用此代码联系支持人员。',
    'palsScreen.purchase.recommendedModel': '推荐模型',
    'palsScreen.purchase.sampleExchange': '示例对话',
    'palsScreen.purchase.signInLine': '已拥有？登录',
    'palsScreen.purchase.licenseNotice': '您购买的是使用此 Pal 的许可。',
    'palsScreen.purchase.termsOfSale': '销售条款',
    'palsScreen.purchase.appleMediaTerms': 'Apple 媒体服务条款',
    'palsScreen.purchase.linkPrompt': '登录以在其他设备上使用',
    'palsScreen.purchase.linkSignIn': '登录',
    'palsScreen.purchase.dismiss': '暂不',
    'palsScreen.purchase.linkConflict': '这些购买已关联到另一个账户。',
    'palsScreen.purchase.restorePurchases': '恢复购买',
    'palsScreen.purchase.badgePending': '待处理',
    'palsScreen.purchase.badgeUnlocking': '正在解锁',
    'palsScreen.purchase.badgeUpdate': '有可用更新',
    'palsScreen.purchase.updatePrompt': '创作者发布了新版本。',
    'palsScreen.purchase.updatePromptWithNote': '创作者发布了新版本：{{note}}。',
    'palsScreen.purchase.updateButton': '更新',
    'palsScreen.purchase.updateConfirmText': '这将替换您对创作者修改部分所做的编辑。',
    'palsScreen.purchase.updateConfirm': '更新',
    'palsScreen.purchase.updateCancel': '取消',
    'palsScreen.purchase.modelStep.download': '下载 · {{size}}',
    'palsScreen.purchase.modelStep.startChat': '开始聊天',
    'palsScreen.purchase.modelStep.needsMemory': '此 Pal 需要设备至少具备 {{size}} 内存才能运行其最小模型。',
    'palsScreen.purchase.modelStep.noModelFits': '此设备没有足够的内存来运行此 Pal。',
    'downloadBanner.failedTitle': '下载未完成',
    'downloadBanner.retry': '重试',
}

def set_path(d, dotted, value):
    parts = dotted.split('.')
    cur = d
    for p in parts[:-1]:
        if p not in cur or not isinstance(cur[p], dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value

added = 0
for key, val in additions.items():
    set_path(zh, key, val)
    added += 1

with open(path, 'w', encoding='utf-8') as f:
    json.dump(zh, f, ensure_ascii=False, indent=2)

print(f'已补充 {added} 个中文翻译')
