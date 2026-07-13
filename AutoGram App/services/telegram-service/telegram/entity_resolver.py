class EntityResolver:

    async def resolve(self, entity):
        return {
            "entity": entity,
            "resolved": True
        }
