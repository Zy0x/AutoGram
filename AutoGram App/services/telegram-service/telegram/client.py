class TelegramClientService:

    async def connect(self):
        return True

    async def disconnect(self):
        return True

    async def health_check(self):
        return {"connected": True}
