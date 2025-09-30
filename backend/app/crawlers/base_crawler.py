from abc import ABC, abstractmethod
from typing import Dict, List, Optional
from datetime import datetime, date
import logging

logger = logging.getLogger(__name__)

class BaseCrawler(ABC):
    def __init__(self):
        self.session = None

    @abstractmethod
    def fetch_stock_list(self) -> List[Dict]:
        pass


    @abstractmethod
    def fetch_stock_info(self, symbol: str) -> Dict:
        pass

    def close(self):
        if self.session:
            self.session.close()