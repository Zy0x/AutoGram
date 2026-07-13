class TelegramProviderInterface:

    async def fetch_messages(self):
        raise NotImplementedError

    async def transfer(self):
        raise NotImplementedError
