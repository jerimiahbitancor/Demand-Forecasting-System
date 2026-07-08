from fastapi import APIRouter

router = APIRouter()

@router.get("/test")
async def test_route():
    return {"message": "API is working"}

# You can add more routes here